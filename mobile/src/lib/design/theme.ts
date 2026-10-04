export const colors = {
  paper: '#F7F2E8',
  paperDeep: '#EFE6D7',
  surface: '#FFFDF8',
  surfaceRaised: '#FFFEFA',
  ink: '#282621',
  inkSoft: '#625E55',
  inkMuted: '#8A8478',
  placeholder: '#AAA398',
  line: '#DED5C7',
  lineStrong: '#CFC2B1',
  rose: '#C97972',
  roseSoft: '#F0D8D3',
  sage: '#758B78',
  sageSoft: '#DCE5D8',
  blue: '#6F8290',
  blueSoft: '#DCE5E9',
  ochre: '#A77A42',
  ochreSoft: '#EFE0C6',
  danger: '#9B4B45',
  dangerSoft: '#F3DBD7',
  white: '#FFFFFF',
} as const;

export const radii = {
  small: 10,
  medium: 16,
  large: 24,
  pill: 999,
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 44,
} as const;

export const shadows = {
  paper: {
    shadowColor: '#574C3C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  floating: {
    shadowColor: '#574C3C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 7,
  },
} as const;
