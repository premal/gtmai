import parser from '@typescript-eslint/parser';
export default [
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**'] },
  { files: ['**/*.{js,mjs,ts,tsx}'], languageOptions: { parser }, rules: {} },
];
