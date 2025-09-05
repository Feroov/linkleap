import { clsx } from "clsx";
export function Card(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={clsx(
        "rounded-xl2 border border-[#23283a] bg-panel shadow-glow",
        props.className
      )}
    />
  );
}
