import js from '@eslint/js';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  { ignores: ['dist'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': hooks },
    rules: hooks.configs['recommended-latest'].rules,
  },
  { files: ['*.js', '*.ts', 'scripts/*.mjs'], languageOptions: { globals: globals.node } },
);
