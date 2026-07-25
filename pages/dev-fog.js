import dynamic from 'next/dynamic';

const DevFog = dynamic(() => import('../components/DevFog'), { ssr: false });

export default function DevFogPage() {
  return <DevFog />;
}
