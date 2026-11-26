import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: { DEFAULT: '1rem', sm: '1.5rem', lg: '2rem' }, screens: { '2xl': '1280px' } },
    screens: { xs: '400px', sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1440px' },
    extend: {
      colors: {
        border: token('border'),
        input: token('input'),
        ring: token('ring'),
        background: token('background'),
        foreground: token('foreground'),
        primary: { DEFAULT: token('primary'), foreground: token('primary-foreground') },
        secondary: { DEFAULT: token('secondary'), foreground: token('secondary-foreground') },
        destructive: { DEFAULT: token('destructive'), foreground: token('destructive-foreground') },
        muted: { DEFAULT: token('muted'), foreground: token('muted-foreground') },
        accent: { DEFAULT: token('accent'), foreground: token('accent-foreground') },
        popover: { DEFAULT: token('popover'), foreground: token('popover-foreground') },
        card: { DEFAULT: token('card'), foreground: token('card-foreground') },
        sidebar: { DEFAULT: token('sidebar'), foreground: token('sidebar-foreground') },
        button: { DEFAULT: token('button'), foreground: token('button-foreground') },
        brand: { 2: token('brand-secondary'), 3: token('brand-accent') },
        success: token('success'),
        warning: token('warning'),
        whatsapp: '#25D366',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
        btn: 'var(--btn-radius)',
      },
      fontFamily: { sans: ['var(--font-sans)'], display: ['var(--font-display)'] },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'float-slow': { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        'progress-slide': { '0%': { transform: 'translateX(-110%)' }, '100%': { transform: 'translateX(260%)' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'soft-pulse': { '0%,100%': { opacity: '1' }, '50%': { opacity: '.55' } },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        'float-slow': 'float-slow 7s ease-in-out infinite',
        'progress-slide': 'progress-slide 1.2s ease-in-out infinite',
        'fade-up': 'fade-up .45s cubic-bezier(.16,1,.3,1) both',
        'soft-pulse': 'soft-pulse 2s ease-in-out infinite',
      },
      boxShadow: {
        soft: '0 8px 30px -12px hsl(var(--primary) / 0.25)',
        card: '0 1px 2px hsl(var(--foreground) / 0.04), 0 8px 24px -16px hsl(var(--foreground) / 0.12)',
        lift: '0 2px 4px hsl(var(--foreground) / 0.04), 0 18px 40px -20px hsl(var(--foreground) / 0.22)',
        glow: '0 0 0 1px hsl(var(--primary) / 0.15), 0 10px 30px -10px hsl(var(--primary) / 0.45)',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
