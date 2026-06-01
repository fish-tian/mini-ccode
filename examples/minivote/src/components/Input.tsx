import styles from "../styles/Input.module.css";

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "url";
  autoFocus?: boolean;
}

export default function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  autoFocus = false,
}: InputProps) {
  return (
    <input
      type={type}
      className={styles.input}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
    />
  );
}
