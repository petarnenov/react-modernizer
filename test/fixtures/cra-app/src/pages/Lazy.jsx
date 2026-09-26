export default function Lazy() {
  return <div>lazy</div>;
}

export const loadPage = (name) => import(`./${name}`);
