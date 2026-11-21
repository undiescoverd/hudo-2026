import type { Config } from 'tailwindcss'

// Design v3 (S4-DESIGN-001): the default Tailwind scales are remapped so the
// hardcoded gray/blue/red/green/amber/yellow utilities across app/ and
// components/ reskin onto Graphite & Coral without touching every file.
// Anchors are the v3 tokens; every stop used for text/background pairs was
// checked against WCAG AA 4.5:1 (see the PR description).
const graphite = {
  50: '#f5f5f3', // bg
  100: '#efefec', // surface-2
  200: '#e2e2de', // line
  300: '#cdcdc8',
  400: '#70737a',
  500: '#66696f', // faint
  600: '#5d6068', // muted
  700: '#43464d',
  800: '#2b2d32',
  900: '#17181b', // text
  950: '#0f1012',
}

// "blue" carried primary buttons/links; it is now the coral accent scale.
const coralScale = {
  50: '#fdf1ed',
  100: '#fbe3dc',
  200: '#f6c5b8',
  300: '#ee9c85',
  400: '#e2704f',
  500: '#d9431f',
  600: '#cc3b18', // accent
  700: '#b83514', // accent-text
  800: '#922a10',
  900: '#6e200c',
  950: '#3f1107',
}

const redScale = {
  50: '#fef3f1',
  100: '#fde4e1', // status changes bg
  200: '#fbc9c3',
  300: '#f5a199',
  400: '#ea6f63',
  500: '#d9382b',
  600: '#c42b1f',
  700: '#b42318', // status changes fg
  800: '#8f1c13',
  900: '#701710',
  950: '#3d0b07',
}

const greenScale = {
  50: '#f1faf4',
  100: '#dcf3e5', // status approved bg
  200: '#b9e6cc',
  300: '#8bd3a9',
  400: '#4fb67a',
  500: '#25995a',
  600: '#17803f',
  700: '#157040', // status approved fg
  800: '#0f5a32',
  900: '#0c482a',
  950: '#062b19',
}

const amberScale = {
  50: '#fdf7e6',
  100: '#fbefcf', // status pending bg
  200: '#f6dd9b',
  300: '#efc65e',
  400: '#e0a62a',
  500: '#c98a0a',
  600: '#a8700a',
  700: '#8a5a00', // status pending fg
  800: '#8a5a00',
  900: '#6b4500',
  950: '#3a2400',
}

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: '',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        gray: graphite,
        blue: coralScale,
        red: redScale,
        green: greenScale,
        amber: amberScale,
        yellow: amberScale,
        // v3 semantic colours (raw CSS vars, no hsl wrapper)
        surface: { DEFAULT: 'var(--surface)', 2: 'var(--surface-2)' },
        line: 'var(--line)',
        faint: 'var(--faint)',
        stage: 'var(--stage)',
        coral: {
          DEFAULT: 'var(--coral)',
          text: 'var(--coral-text)',
          soft: 'var(--coral-soft)',
          on: 'var(--coral-on)',
        },
        status: {
          draft: { fg: 'var(--st-draft-fg)', bg: 'var(--st-draft-bg)' },
          pending: { fg: 'var(--st-pending-fg)', bg: 'var(--st-pending-bg)' },
          review: { fg: 'var(--st-review-fg)', bg: 'var(--st-review-bg)' },
          changes: { fg: 'var(--st-changes-fg)', bg: 'var(--st-changes-bg)' },
          approved: { fg: 'var(--st-approved-fg)', bg: 'var(--st-approved-bg)' },
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
