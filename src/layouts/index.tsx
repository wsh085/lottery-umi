import { Link, Outlet } from "umi";
import { ConfigProvider as AntConfigProvider } from "antd";
import "styles/index.less";
import zhCN from "antd/locale/zh_CN";
import styles from "./index.less";

export default function Layout() {
  return (
    <AntConfigProvider locale={zhCN}>
      <div className={styles.navs}>
        <ul>
          <li>
            <Link to="/">首页</Link>
          </li>
          <li>
            <Link to="/hongqiu">红球_走势统计</Link>
          </li>
          <li>
            <Link to="/number">数字_统计</Link>
          </li>
          <li>
            <Link to="/preshahao">前区杀号</Link>
          </li>
          <li>
            <Link to="/piantaifenxi">偏态分析</Link>
          </li>
          <li>
            <Link to="/lishichaxun">历史查询</Link>
          </li>
          {/* <li>
          <Link to="/tensorflow">学习预测</Link>
        </li> */}
        </ul>
        <Outlet />
      </div>
    </AntConfigProvider>
  );
}
