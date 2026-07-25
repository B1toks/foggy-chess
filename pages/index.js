import dynamic from 'next/dynamic';
import Head from 'next/head';

const GameCanvas = dynamic(() => import('../components/GameCanvas'), { ssr: false });

export default function Home() {
  return (
    <>
      <Head>
        <title>dead-reckoning</title>
        <meta name="description" content="3D fog-of-war chess" />
      </Head>
      <GameCanvas />
    </>
  );
}
