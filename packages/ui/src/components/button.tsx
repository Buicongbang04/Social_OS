import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-neutral-900 text-white hover:bg-neutral-700",
  secondary: "bg-neutral-100 text-neutral-900 hover:bg-neutral-200",
  ghost: "bg-transparent hover:bg-neutral-100",
  destructive: "bg-red-600 text-white hover:bg-red-700",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
          VARIANT_CLASSES[variant],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
