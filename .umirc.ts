import { defineConfig } from "umi";

export default defineConfig({
  routes: [
    { path: "/", component: "index" },
    { path: "/hongqiu", component: "hongqiu" },
    { path: "/number", component: "number" },
    { path: "/preshahao", component: "preshahao" },
    { path: "/piantaifenxi", component: "piantaifenxi" },
    { path: "/lishichaxun", component: "lishichaxun" },
    { path: "/weilanfenxi", component: "weilanfenxi" },
    { path: "/ssq/historySearch", component: "ssq/historySearch" },
  ],
  alias: {
    data: '/data',
    dSsq: '/dSsq',
    src: '/src',
    styles: '/src/styles'
  },
  npmClient: 'pnpm',
});
