// Recharts 2.x ships class-component types that, under @types/react 18 and this
// tsconfig, TS rejects as JSX components (TS2786/TS2607). Re-export the consumed
// components through an FC-typed boundary so call sites type-check. Type-only:
// runtime identity is unchanged.
import {
  XAxis as RXAxis,
  YAxis as RYAxis,
  Legend as RLegend,
  Area as RArea,
} from 'recharts';
import type { ComponentType } from 'react';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const XAxis = RXAxis as unknown as ComponentType<any>;
export const YAxis = RYAxis as unknown as ComponentType<any>;
export const Legend = RLegend as unknown as ComponentType<any>;
export const Area = RArea as unknown as ComponentType<any>;
/* eslint-enable @typescript-eslint/no-explicit-any */
