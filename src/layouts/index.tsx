import { Link, Outlet } from "umi";
import "styles/index.less";
import styles from "./index.less";

export default function Layout() {
  return (
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
      </ul>
      <Outlet />
    </div>
  );
}
