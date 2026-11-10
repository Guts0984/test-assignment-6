import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'storybook-static/**',
      'next-env.d.ts',
      'playwright-report/**',
      'src/server/db/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...nextVitals,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': 'allow-with-description',
          'ts-expect-error': 'allow-with-description',
          'ts-nocheck': true,
          minimumDescriptionLength: 10,
        },
      ],
      // Assignment: no `Date` for calculations in time zones. Use Temporal (src/shared/time).
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            'Use Temporal, not Date (assignment rule). If it is only an instant boundary, disable with a justification.',
        },
        {
          selector:
            "CallExpression[callee.object.name='Date'][callee.property.name=/^(UTC|parse)$/]",
          message: 'Use Temporal, not Date.',
        },
        {
          selector: "MemberExpression[property.name='getTimezoneOffset']",
          message: 'Use Temporal for time zone offsets.',
        },
      ],
    },
  },
  {
    // Feature-based architecture boundaries.
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app/**' },
        { type: 'feature', pattern: 'src/features/*', capture: ['name'] },
        { type: 'server', pattern: 'src/server/**' },
        { type: 'shared', pattern: 'src/shared/**' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'app' } },
              allow: { to: { element: { type: ['app', 'feature', 'server', 'shared'] } } },
            },
            {
              from: { element: { type: 'feature' } },
              allow: { to: { element: { type: ['feature', 'shared'] } } },
            },
            {
              from: { element: { type: 'server' } },
              allow: { to: { element: { type: ['server', 'shared'] } } },
            },
            {
              from: { element: { type: 'shared' } },
              allow: { to: { element: { type: 'shared' } } },
            },
          ],
        },
      ],
      // Features expose a public API via index.ts; deep imports into another feature are forbidden.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/features/*/*'], message: 'Import features through their index.ts only.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'e2e/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
