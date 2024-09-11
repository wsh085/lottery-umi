import { defineConfig } from "umi";

export default defineConfig({
  routes: [
    { path: "/", component: "index" },
    { path: "/hongqiu", component: "hongqiu" },
    { path: "/number", component: "number" },
    { path: "/preshahao", component: "preshahao" },
    { path: "/piantaifenxi", component: "piantaifenxi" },
  ],
  alias: {
    data: '/data',
    src: '/src',
    styles: '/src/styles'
  },
  npmClient: 'pnpm',
});
