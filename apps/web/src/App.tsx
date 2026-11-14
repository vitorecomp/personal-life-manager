import { FUI_TOKENS } from '@hermes/ui';

export function App() {
  return (
    <main
      data-testid="hermes-web-shell"
      style={{
        backgroundColor: FUI_TOKENS.bgCarbon,
        color: FUI_TOKENS.inkStark,
        minHeight: '100vh',
      }}
    >
      <header style={{ borderBottom: `1px solid ${FUI_TOKENS.accentOrange}`, padding: '12px 16px' }}>
        <span>HERMES // OS — COMMAND DECK</span>
      </header>
    </main>
  );
}
