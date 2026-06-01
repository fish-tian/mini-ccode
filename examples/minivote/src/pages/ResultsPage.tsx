import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchResults } from "../api";
import type { PollResults, ResultOption } from "../types";
import ShareButton from "../components/ShareButton";
import ToastContainer from "../components/Toast";
import styles from "../styles/pages/Results.module.css";

const BAR_COLORS = [
  "#007AFF",
  "#34C759",
  "#FF9500",
  "#FF3B30",
  "#AF52DE",
  "#5856D6",
  "#FF2D55",
  "#00C7BE",
];

function OptionBar({
  option,
  color,
  maxPercent,
  animate,
  index,
}: {
  option: ResultOption;
  color: string;
  maxPercent: number;
  animate: boolean;
  index: number;
}) {
  return (
    <div className={styles.optionBar}>
      <div className={styles.barHeader}>
        <span className={styles.barLabel}>{option.text}</span>
        <span className={styles.barPercent}>{option.percent}%</span>
      </div>
      <div className={styles.barTrack}>
        <div
          className={styles.barFill}
          style={{
            width: animate ? `${(option.percent / maxPercent) * 100}%` : "0%",
            background: color,
            transition: animate
              ? `width 0.8s cubic-bezier(0.25, 0.1, 0.25, 1) ${index * 0.1}s`
              : "none",
          }}
        />
      </div>
      <span className={styles.barCount}>{option.count} 票</span>
    </div>
  );
}

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [results, setResults] = useState<PollResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [animate, setAnimate] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!id || loadedRef.current) return;
    loadedRef.current = true;

    fetchResults(id)
      .then((data) => {
        setResults(data);
        // Trigger animation after render
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setAnimate(true));
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className={styles.state}>
        <div className={styles.spinner} />
        <p className={styles.stateText}>加载结果中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.state}>
        <p className={styles.errorIcon}>🔒</p>
        <p className={styles.stateText}>{error}</p>
        <p className={styles.hint}>
          {id && (
            <button className={styles.linkBtn} onClick={() => navigate(`/poll/${id}`)}>
              去投票 →
            </button>
          )}
        </p>
      </div>
    );
  }

  if (!results) return null;

  const maxPercent = Math.max(...results.options.map((o) => o.percent), 1);

  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={() => navigate("/")}>
        ← 返回首页
      </button>

      <div className={styles.heading}>
        <div className={styles.badge}>✅ 投票成功</div>
        <h1 className={styles.title}>{results.pollTitle}</h1>
        <p className={styles.subtitle}>共 {results.totalVotes} 票</p>
      </div>

      <div className={styles.chartCard}>
        {results.options.map((option, i) => (
          <OptionBar
            key={option.id}
            option={option}
            index={i}
            color={BAR_COLORS[i % BAR_COLORS.length]}
            maxPercent={maxPercent}
            animate={animate}
          />
        ))}
      </div>

      <div className={styles.actions}>
        <ShareButton pollId={id!} />
      </div>

      <ToastContainer />
    </div>
  );
}
