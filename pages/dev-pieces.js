import dynamic from 'next/dynamic';

const DevPieceRow = dynamic(() => import('../components/DevPieceRow'), { ssr: false });

export default function DevPiecesPage() {
  return <DevPieceRow />;
}
