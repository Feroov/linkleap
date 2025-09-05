import { clsx } from "clsx";
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={clsx(
        "rounded-xl2 bg-[#0f1422] border border-[#23283a] px-3 py-2 outline-none focus:border-accent/60",
        props.className
      )}
    />
  );
}
