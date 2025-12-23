import { cn } from "@/lib/utils";
import thothLogo from "@/assets/thoth-logo.png";
interface ThothLogoProps {
  size?: "sm" | "md" | "lg" | "xl";
  showText?: boolean;
  className?: string;
  animated?: boolean;
}
export function ThothLogo({
  size = "md",
  showText = true,
  className,
  animated = false
}: ThothLogoProps) {
  const sizes = {
    sm: "h-8 w-8",
    md: "h-10 w-10",
    lg: "h-14 w-14",
    xl: "h-20 w-20"
  };
  const textSizes = {
    sm: "text-xl",
    md: "text-2xl",
    lg: "text-3xl",
    xl: "text-5xl"
  };
  return <div className={cn("flex items-center gap-3", className)}>
      <img src={thothLogo} alt="Thoth24 Logo" className={cn(sizes[size], "object-contain", animated && "hover:scale-105 transition-transform duration-300")} />

      {showText && <div className="flex flex-col leading-none">
          <span className={cn("font-display font-bold tracking-tight", textSizes[size])}>
            <span className="text-gradient-primary">THOTH</span>
            <span className="text-destructive-foreground">.​AI</span>
          </span>
          {size !== "sm" && <span className="text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground mt-0.5">
              Parceiro Bitrix24
            </span>}
        </div>}
    </div>;
}