/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0d1016",
        panel: "#121723",
        panel2: "#171c2b",
        accent: "#7c9cff",
        accent2: "#49f2c2",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(124,156,255,.15), 0 10px 30px rgba(0,0,0,.4)",
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      keyframes: {
        floaty: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-4px)" } },
        pingSlow: { "0%": { opacity: 0.8 }, "80%,100%": { opacity: 0, transform: "scale(1.2)" } },
        gradientX: { "0%": { backgroundPosition: "0% 50%" }, "100%": { backgroundPosition: "100% 50%" } },
      },
      animation: {
        floaty: "floaty 5s ease-in-out infinite",
        pingSlow: "pingSlow 2.5s cubic-bezier(0,0,.2,1) infinite",
        gradientX: "gradientX 3s linear infinite",
      },
    },
  },
  plugins: [],
};
