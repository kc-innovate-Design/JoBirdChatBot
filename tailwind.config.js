/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                jobird: {
                    red: '#D94637',
                    navy: '#23398f',
                    blue: '#23398f', // Alias for navy
                    yellow: '#fec311', // Safety Yellow
                    green: '#008a00',
                    lightGrey: '#f4f4f4',
                    darkNavy: '#0f172a',
                    slate: '#64748b',
                }
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
            }
        }
    },
    plugins: [],
}
