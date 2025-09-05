"use client";
import { cva, type VariantProps } from "class-variance-authority";
import clsx from "clsx";
const styles = cva(
  "inline-flex items-center justify-center rounded-xl2 border transition active:scale-[.99] disabled:opacity-50 disabled:cursor-not-allowed",
  {
    variants: {
      look: {
        solid: "bg-panel2 border-[#262b3a] hover:border-[#2e3548] shadow-glow",
        ghost: "bg-transparent border-[#23293b] hover:bg-[#151a28]",
        accent: "bg-accent/90 hover:bg-accent text-black border-transparent shadow-glow",
      },
      size: { sm:"px-3 py-2 text-sm", md:"px-4 py-2.5", lg:"px-5 py-3 text-lg" },
    },
    defaultVariants: { look: "solid", size: "md" },
  }
);
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof styles>;
export function Button({ look, size, className, ...props }: Props) {
  return <button className={clsx(styles({ look, size }), className)} {...props} />;
}
