import React from 'react';

export default function Tier2({enabled}: {enabled: boolean}) {
  if (enabled) return <div>Tier 2</div>;
  throw new Error('Enabled prop missing');
}
