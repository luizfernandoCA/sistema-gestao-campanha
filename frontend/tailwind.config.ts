import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"SF Pro Display"', '"Inter"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"SF Mono"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: { 50:'#f8f8f8', 100:'#f0f0f0', 200:'#e4e4e4', 300:'#c8c8c8', 400:'#9e9e9e',
               500:'#737373', 600:'#525252', 700:'#3a3a3a', 800:'#262626', 900:'#171717', 950:'#0a0a0a' },
        accent: { 500:'#0a84ff', 600:'#0066d6' },
      },
      animation: {
        'fade-in-up':    'fadeInUp 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) forwards',
        'fade-in':       'fadeIn 0.4s ease-out forwards',
        'gradient-pan':  'gradientPan 18s ease-in-out infinite',
        'shimmer':       'shimmer 2.2s linear infinite',
      },
      keyframes: {
        fadeInUp: { '0%': { opacity:'0', transform:'translateY(12px)' }, '100%': { opacity:'1', transform:'translateY(0)' } },
        fadeIn:   { '0%': { opacity:'0' }, '100%': { opacity:'1' } },
        gradientPan: { '0%,100%': { backgroundPosition:'0% 50%' }, '50%': { backgroundPosition:'100% 50%' } },
        shimmer:  { '0%': { backgroundPosition:'-200% 0' }, '100%': { backgroundPosition:'200% 0' } },
      },
      backdropBlur: { '3xl': '64px' },
    },
  },
  plugins: [],
};
export default config;
