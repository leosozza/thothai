import { cn } from "@/lib/utils";

interface ThothLogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  showText?: boolean;
  className?: string;
}

export function ThothLogo({ size = "md", showText = true, className }: ThothLogoProps) {
  const sizes = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-12 w-12",
    xl: "h-16 w-16",
  };

  const textSizes = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-2xl",
    xl: "text-4xl",
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Ibis Bird Icon - Symbol of Thoth */}
      <div className={cn("relative", sizes[size])}>
        <svg
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-full w-full"
        >
          {/* Pyramid base */}
          <path
            d="M20 4L36 32H4L20 4Z"
            className="fill-primary"
            opacity="0.9"
          />
          {/* Eye of Thoth */}
          <circle
            cx="20"
            cy="18"
            r="5"
            className="fill-primary-foreground"
          />
          <circle
            cx="20"
            cy="18"
            r="2.5"
            className="fill-primary"
          />
          {/* Glow effect */}
          <circle
            cx="20"
            cy="18"
            r="7"
            className="stroke-primary"
            strokeWidth="0.5"
            fill="none"
            opacity="0.5"
          />
        </svg>
      </div>

      {showText && (
        <div className="flex flex-col leading-none">
          <span className={cn("font-display font-bold tracking-tight text-gradient-gold", textSizes[size])}>
            thoth
            <span className="text-primary">.AI</span>
          </span>
          {size !== "sm" && (
            <span className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
              Agente Inteligente
            </span>
          )}
        </div>
      )}
    </div>
  );
}
