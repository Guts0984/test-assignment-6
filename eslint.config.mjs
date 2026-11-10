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
      'src/server/core/db/migrations/**',
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
    // Architecture boundaries (frontend features and backend modules follow the same idea).
    //
    //   src/server/core     generic infrastructure (db, http, env). Knows no domain.
    //   src/server/modules  one folder per domain (auth, rooms, events). Public API = index.ts.
    //   src/server/tools    seed, test harness, container bootstrap: may use everything on the server.
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app/**' },
        { type: 'feature', pattern: 'src/features/*', capture: ['name'] },
        { type: 'server-core', pattern: 'src/server/core/**' },
        { type: 'server-module', pattern: 'src/server/modules/*', capture: ['name'] },
        { type: 'server-tools', pattern: 'src/server/tools/**' },
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
              allow: {
                to: {
                  element: { type: ['app', 'feature', 'server-core', 'server-module', 'shared'] },
                },
              },
            },
            {
              from: { element: { type: 'feature' } },
              allow: { to: { element: { type: ['feature', 'shared'] } } },
            },
            {
              from: { element: { type: 'server-core' } },
              allow: { to: { element: { type: ['server-core', 'shared'] } } },
            },
            {
              from: { element: { type: 'server-module' } },
              allow: { to: { element: { type: ['server-core', 'server-module', 'shared'] } } },
            },
            {
              from: { element: { type: 'server-tools' } },
              allow: {
                to: {
                  element: { type: ['server-core', 'server-module', 'server-tools', 'shared'] },
                },
              },
            },
            {
              from: { element: { type: 'shared' } },
              allow: { to: { element: { type: 'shared' } } },
            },
          ],
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/features/*/*'], message: 'Import features through their index.ts only.' },
            {
              // `schema` is the one other public file: tables are referenced by foreign keys.
              group: [
                '@/server/modules/*/*',
                '!@/server/modules/*/schema',
                '!@/server/modules/*/http',
              ],
              message:
                'Import a module through index.ts (domain API) or http.ts (route handlers); schema.ts for tables.',
            },
          ],
        },
      ],
    },
  },
  {
    // Tests may reach into anything: they test internals and use the shared test harness.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/tests/**', 'e2e/**'],
    rules: {
      'no-restricted-syntax': 'off',
      'boundaries/dependencies': 'off',
      'no-restricted-imports': 'off',
    },
  },
);
