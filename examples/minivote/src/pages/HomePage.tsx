import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchPolls } from "../api";
import type { PollSummary } from "../types";
import Card from "../components/Card";
import ToastContainer from "../components/Toast";
import styles from "../styles/pages/Home.module.css";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr + "Z").getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
  return new Date(dateStr).toLocaleDateString("zh-CN");
}

export default function HomePage() {
  const [polls, setPolls] = useState<PollSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchPolls()
      .then(setPolls)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className={styles.state}>
        <div className={styles.spinner} />
        <p className={styles.stateText}>加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.state}>
        <p className={styles.errorIcon}>😞</p>
        <p className={styles.stateText}>加载失败</p>
        <p className={styles.errorDetail}>{error}</p>
      </div>
    );
  }

  if (polls.length === 0) {
    return (
      <div className={styles.state}>
        <p className={styles.emptyIcon}>📭</p>
        <p className={styles.stateText}>还没有投票</p>
        <p className={styles.hint}>创建第一个投票吧</p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <h1 className={styles.title}>所有投票</h1>
        <p className={styles.subtitle}>{polls.length} 个投票</p>
      </div>

      <div className={styles.list}>
        {polls.map((poll) => (
          <Card
            key={poll.id}
            hover
            onClick={() => navigate(`/poll/${poll.id}`)}
          >
            <div className={styles.pollCard}>
              <h3 className={styles.pollTitle}>{poll.title}</h3>
              <div className={styles.pollMeta}>
                <span>{poll.option_count} 个选项</span>
                <span className={styles.dot}>·</span>
                <span>{poll.vote_count} 人已投票</span>
                <span className={styles.dot}>·</span>
                <span>{timeAgo(poll.created_at)}</span>
              </div>
              <div className={styles.arrow}>→</div>
            </div>
          </Card>
        ))}
      </div>

      <ToastContainer />
    </div>
  );
}
