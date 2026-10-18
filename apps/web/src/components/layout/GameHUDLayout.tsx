import type { ComponentProps } from 'react';
export function GameHUDLayout({
  joined,
  shortChat,
  ...props
}: ComponentProps<'main'> & { joined: boolean; shortChat: boolean }) {
  return (
    <main
      {...props}
      className={
        joined ? `in-game${shortChat ? ' hud-short-chat' : ''}` : 'in-lobby'
      }
    />
  );
}
