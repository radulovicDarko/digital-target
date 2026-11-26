import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { TargetConfigSchema } from '@/api/schemas';
import { darkTheme } from '@/theme/tokens';
import type { Hit, TargetConfig } from '@/types/session';
import { LiveTargetCanvas } from '../LiveTargetCanvas';

jest.mock('@shopify/react-native-skia', () => {
  const React = require('react');
  const { View } = require('react-native');
  const component = (testID: string) => ({ children, ...props }: { children?: ReactNode }) =>
    React.createElement(View, { ...props, testID }, children);
  return {
    Canvas: component('canvas'), Circle: component('circle'), Group: component('group'),
    Path: component('path'), Rect: component('paper'),
    vec: (x: number, y: number) => ({ x, y }),
    Skia: { PathBuilder: { Make: () => ({ addCircle: jest.fn(), detach: () => ({}) }) } },
  };
});

const config: TargetConfig = {
  paperMm: 100, paperBoundsMm: [-57.5, -52, 42.5, 48],
  ringDiametersMm: [83, 74, 65, 56, 47, 38, 29, 20, 11, 2],
  innerTenMm: 2, pelletMm: 4.5, discipline: 'test',
};
const miss: Hit = {
  sessionId: 'test', ts: 1, score: 0, ring: 0, isInnerTen: false,
  xMm: -56.5, yMm: -51, distMm: 76.1, xNorm: 0.01, yNorm: 0.01,
};

it.each([null, miss.ts])('renders a corner miss gray at the paper edge (focus %s)', async (highlightTs) => {
  const screen = await render(<LiveTargetCanvas size={200} config={config} hits={[miss]} highlightTs={highlightTs} />);
  const paper = screen.getByTestId('paper');
  expect(paper.props).toMatchObject({ x: 2, y: 2, width: 196, height: 196 });
  const circles = screen.getAllByTestId('circle');
  expect(circles[0]?.props.cx).toBeCloseTo(114.7);
  expect(circles[0]?.props.cy).toBeCloseTo(103.92);
  const markers = circles.filter((circle) => circle.props.color === darkTheme.colors.ringPalette[0]);
  expect(markers).toHaveLength(1);
  expect(markers[0]?.props.cx).toBeCloseTo(3.96);
  expect(markers[0]?.props.cy).toBeCloseTo(3.96);
});

it('keeps older target configurations centered', async () => {
  const { paperBoundsMm: _bounds, ...legacy } = config;
  const screen = await render(<LiveTargetCanvas size={200} config={legacy} hits={[]} />);
  expect(screen.getAllByTestId('circle')[0]?.props).toMatchObject({ cx: 100, cy: 100 });
});

it('accepts optional offset metadata but rejects reversed paper bounds', () => {
  const target = {
    paper_mm: 100, ring_diameters_mm: [83, 2], inner_ten_mm: 2, pellet_mm: 4.5, discipline: 'test',
  };
  expect(TargetConfigSchema.safeParse(target).success).toBe(true);
  expect(TargetConfigSchema.parse({ ...target, paper_bounds_mm: config.paperBoundsMm }).paper_bounds_mm)
    .toEqual(config.paperBoundsMm);
  expect(TargetConfigSchema.safeParse({ ...target, paper_bounds_mm: [42.5, -52, -57.5, 48] }).success).toBe(false);
});
