import { fixupPluginRules } from '@eslint/compat';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: ['node_modules/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 'latest',
      parser: tseslint.parser,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      import: fixupPluginRules(importPlugin),
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-shadow': 'error',
      'complexity': ['error', { max: 20 }],
      'eqeqeq': 'error',
      'no-console': 'error',
      'no-constant-binary-expression': 'error',
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      'no-self-compare': 'error',
      'no-unreachable': 'error',
      'no-unreachable-loop': 'error',
      'no-unused-vars': 'off',
      'no-var': 'error',
      'prefer-const': 'error',
      'quotes': ['error', 'single', { avoidEscape: true }],
      'comma-dangle': ['error', 'always-multiline'],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^\\.\\./',
              message: 'Use @/ aliases instead of parent-relative imports.',
            },
          ],
        },
      ],
      'import/order': [
        'error',
        {
          alphabetize: {
            caseInsensitive: true,
            order: 'asc',
          },
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
            'object',
            'type',
          ],
          'newlines-between': 'always',
          pathGroups: [
            {
              group: 'internal',
              pattern: '@/**',
            },
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
        },
      ],
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
];
