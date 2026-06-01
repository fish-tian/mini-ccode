import { Outlet, Link, useLocation } from "react-router-dom";
import styles from "../styles/Layout.module.css";

export default function Layout() {
  const location = useLocation();
  const isHome = location.pathname === "/";

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div className={`container ${styles.headerInner}`}>
          <Link to="/" className={styles.logo}>
            <span className={styles.logoIcon}>🗳</span>
            <span className={styles.logoText}>MiniVote</span>
          </Link>
          <nav className={styles.nav}>
            {!isHome && (
              <Link to="/" className={styles.navLink}>
                所有投票
              </Link>
            )}
            <Link to="/create" className={styles.createBtn}>
              + 创建
            </Link>
          </nav>
        </div>
      </header>
      <main className={`container ${styles.main}`}>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <p>MiniVote · 简洁投票</p>
      </footer>
    </div>
  );
}
