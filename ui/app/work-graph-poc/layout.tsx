import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Work Graph POC — Rad Orchestration',
};

export default function WorkGraphPocLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return <>{children}</>;
}
