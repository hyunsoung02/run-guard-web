import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTypescript,
  { ignores: ['.next/**', 'node_modules/**', 'dist/**', 'public/maplibre/**', 'src/**', 'src_backup_before_merge/**', 'android/**', 'ios/**'] },
];

export default config;
