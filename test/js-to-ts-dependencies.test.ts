import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeMissing, missingOnDependencies } from '../src/steps/js-to-ts/dependencies.js';
import { writeFiles } from './helpers/repo.js';

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    jsx: 'preserve',
    target: 'es2020',
    module: 'esnext',
    moduleResolution: 'node',
    noEmit: true,
  },
  include: ['src'],
});

/** A minimal JSX namespace and component base, so the fixtures need no React types. */
const JSX_TYPES = `declare namespace JSX {
  interface Element {}
  interface ElementClass { render(): unknown }
  interface ElementAttributesProperty { props: {} }
  interface IntrinsicElements { [name: string]: unknown }
}
`;
const BASE =
  'export class Component<P = {}> {\n  props!: P;\n  render(): unknown { return null; }\n}\n';
const COMBO_BOX =
  "import { Component } from './Component';\nexport default class ComboBox extends Component {}\n";

async function project(files: Record<string, string>, tsconfig = true): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'modernizer-deps-'));
  await writeFiles(root, {
    ...(tsconfig ? { 'tsconfig.json': TSCONFIG } : {}),
    'src/typings/jsx.d.ts': JSX_TYPES,
    'src/ui/Component.ts': BASE,
    'src/ui/ComboBox.tsx': COMBO_BOX,
    ...files,
  });
  return root;
}

describe('missingOnDependencies', () => {
  it('finds a JSX prop a project component without a props type does not declare', async () => {
    const root = await project({
      'src/Dropdown.tsx':
        "import ComboBox from './ui/ComboBox';\nexport const Dropdown = () => (\n  <ComboBox options={1} />\n);\n",
    });

    const errors = missingOnDependencies(root, ['src/Dropdown.tsx']);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      file: 'src/Dropdown.tsx',
      line: 3,
      declaredIn: 'src/ui/ComboBox.tsx',
    });
    expect(errors[0]?.message).toContain("Property 'options' does not exist");
  });

  it('finds a property missing on an imported value, in the test file too', async () => {
    const root = await project({
      'src/Dropdown.tsx': 'export const Dropdown = 1;\n',
      'src/Dropdown.characterization.test.tsx':
        "import ComboBox from './ui/ComboBox';\nexport const last = ComboBox.lastProps;\n",
    });

    const errors = missingOnDependencies(root, [
      'src/Dropdown.tsx',
      'src/Dropdown.characterization.test.tsx',
    ]);

    expect(errors).toMatchObject([
      {
        file: 'src/Dropdown.characterization.test.tsx',
        line: 2,
        declaredIn: 'src/ui/ComboBox.tsx',
      },
    ]);
  });

  it('finds an argument count an imported function does not allow', async () => {
    const root = await project({
      'src/lib/track.ts': 'export function track(): void {}\n',
      'src/use.ts': "import { track } from './lib/track';\ntrack('page');\n",
    });

    expect(missingOnDependencies(root, ['src/use.ts'])).toMatchObject([
      { file: 'src/use.ts', line: 2, declaredIn: 'src/lib/track.ts' },
    ]);
  });

  it('leaves a type mismatch to the model', async () => {
    const root = await project({
      'src/lib/show.ts': "export function show(kind: 'card' | 'list'): string { return kind; }\n",
      'src/use.ts': "import { show } from './lib/show';\nlet kind = 'card';\nshow(kind);\n",
    });

    expect(missingOnDependencies(root, ['src/use.ts'])).toEqual([]);
  });

  it('leaves a property missing on a local object to the model', async () => {
    const root = await project({
      'src/use.ts': 'const options = { a: 1 };\nexport const b = options.b;\n',
    });

    expect(missingOnDependencies(root, ['src/use.ts'])).toEqual([]);
  });

  it('leaves a property missing on a package type to the model', async () => {
    const root = await project({
      'node_modules/pkg/package.json': '{ "name": "pkg", "types": "index.d.ts" }\n',
      'node_modules/pkg/index.d.ts': 'export declare const pkg: { a: number };\n',
      'src/use.ts': "import { pkg } from 'pkg';\nexport const b = pkg.b;\n",
    });

    expect(missingOnDependencies(root, ['src/use.ts'])).toEqual([]);
  });

  describe('mocked modules', () => {
    const ALIASED = JSON.stringify({
      compilerOptions: {
        ...(JSON.parse(TSCONFIG) as { compilerOptions: object }).compilerOptions,
        baseUrl: '.',
        paths: { '@Hooks/*': ['src/hooks/*'] },
      },
      include: ['src'],
    });
    const HOOKS = {
      'src/hooks/usePushRoute.ts': 'export const usePushRoute = () => (link: string) => link;\n',
      'src/hooks/index.ts': "export { usePushRoute } from './usePushRoute';\n",
    };
    const test = (mock: boolean) =>
      [
        mock ? "jest.mock('@Hooks/index', () => ({ usePushRoute: jest.fn() }));" : '',
        "import { usePushRoute } from '@Hooks/index';",
        'usePushRoute.mockReset();',
        '',
      ].join('\n');

    it('leaves a member missing on an import the file mocks, through an alias, to the model', async () => {
      const root = await project({
        'tsconfig.json': ALIASED,
        ...HOOKS,
        'src/Nav.test.ts': test(true),
      });

      expect(missingOnDependencies(root, ['src/Nav.test.ts'])).toEqual([]);
    });

    it('still blocks the same call when the module is not mocked', async () => {
      const root = await project({
        'tsconfig.json': ALIASED,
        ...HOOKS,
        'src/Nav.test.ts': test(false),
      });

      expect(missingOnDependencies(root, ['src/Nav.test.ts'])).toMatchObject([
        { line: 3, declaredIn: 'src/hooks/usePushRoute.ts' },
      ]);
    });

    it('leaves a member a mock factory adds to a default-imported component to the model', async () => {
      const root = await project({
        'src/Dropdown.test.tsx': [
          "jest.mock('./ui/ComboBox', () => ({ __esModule: true, default: () => null }));",
          "import ComboBox from './ui/ComboBox';",
          'export const last = ComboBox.lastProps;',
          '',
        ].join('\n'),
      });

      expect(missingOnDependencies(root, ['src/Dropdown.test.tsx'])).toEqual([]);
    });
  });

  it('finds nothing without a tsconfig.json', async () => {
    const root = await project(
      {
        'src/Dropdown.tsx':
          "import ComboBox from './ui/ComboBox';\nexport const Dropdown = () => <ComboBox options={1} />;\n",
      },
      false,
    );

    expect(missingOnDependencies(root, ['src/Dropdown.tsx'])).toEqual([]);
  });
});

describe('describeMissing', () => {
  it('names every error and each file to type first once', () => {
    const text = describeMissing([
      {
        file: 'src/A.tsx',
        line: 3,
        message: "Property 'x' does not exist",
        declaredIn: 'src/B.tsx',
      },
      {
        file: 'src/A.tsx',
        line: 9,
        message: "Property 'y' does not exist",
        declaredIn: 'src/B.tsx',
      },
    ]);

    expect(text).toContain("src/A.tsx:3 Property 'x' does not exist (declared in src/B.tsx)");
    expect(text).toContain('src/A.tsx:9');
    expect(text).toMatch(/type these first: src\/B\.tsx$/);
  });
});
