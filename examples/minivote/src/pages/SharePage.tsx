import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchPoll } from "../api";
import styles from "../styles/pages/Share.module.css";

export default function SharePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [message, setMessage] = useState("正在加载...");

  useEffect(() => {
    if (!id) {
      navigate("/", { replace: true });
      return;
    }

    fetchPoll(id)
      .then((poll) => {
        if (poll.hasVoted) {
          navigate(`/results/${id}`, { replace: true });
        } else {
          navigate(`/poll/${id}`, { replace: true });
        }
      })
      .catch(() => {
        setMessage("投票不存在或已失效");
      });
  }, [id, navigate]);

  return (
    <div className={styles.page}>
      <div className={styles.spinner} />
      <p className={styles.text}>{message}</p>
    </div>
  );
}
