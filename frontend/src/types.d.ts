// react-masonry-css 1.0.16 的 d.ts 用了旧版 JSX 类型，跟 React 18 的
// @types/react@18.3.x 不兼容（class 组件返回 JSX.Element）。
// 这里 override 一下，让它返回 React.ReactElement。
declare module 'react-masonry-css' {
  import * as React from 'react';

  export interface MasonryProps {
    breakpointCols?: number | { default: number; [key: number]: number } | { [key: number]: number };
    columnClassName?: string;
    className: string;
    children?: React.ReactNode;
  }

  const Masonry: React.ComponentClass<MasonryProps>;
  export default Masonry;
}
