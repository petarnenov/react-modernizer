import React, { Suspense } from 'react';
import Home from './pages/Home';
import logo from './logo.svg';

const Lazy = React.lazy(() => import('./pages/Lazy'));

export default function App() {
  return (
    <Suspense fallback={<img src={logo} alt="" />}>
      <Home />
      <Lazy />
    </Suspense>
  );
}
