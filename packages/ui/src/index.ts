export const FUI_TOKENS = {
  bgCarbon: '#08080B',
  bgPlum: '#0D0716',
  bgBlueprint: '#10171D',
  bgPanel: '#13151A',
  bgArena: '#141526',
  accentOrange: '#F87C18',
  accentVermilion: '#EB4511',
  accentAmber: '#F59E0B',
  accentCyan: '#2CE5F2',
  accentPhosphor: '#A8F040',
  inkStark: '#F6F6F4',
  borderRadius: '0px',
} as const;

export type FuiTokenKey = keyof typeof FUI_TOKENS;
