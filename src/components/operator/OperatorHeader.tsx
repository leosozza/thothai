import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useOperator } from "@/hooks/useOperator";
import { Headphones, LogOut, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ThothLogo } from "@/components/ThothLogo";

interface OperatorHeaderProps {
  activeConversationsCount: number;
}

export function OperatorHeader({ activeConversationsCount }: OperatorHeaderProps) {
  const { operator, updateOnlineStatus } = useOperator();
  const { signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await updateOnlineStatus(false);
    await signOut();
    navigate("/auth");
  };

  const toggleOnline = async () => {
    if (operator) {
      await updateOnlineStatus(!operator.is_online);
    }
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4">
      <div className="flex items-center gap-4">
        <ThothLogo size="sm" />
        <div className="h-6 w-px bg-border" />
        <div className="flex items-center gap-2">
          <Headphones className="h-5 w-5 text-muted-foreground" />
          <span className="font-medium">Portal do Operador</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Badge variant={activeConversationsCount > 0 ? "default" : "secondary"}>
          {activeConversationsCount} {activeConversationsCount === 1 ? "conversa" : "conversas"}
        </Badge>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {operator?.is_online ? "Online" : "Offline"}
          </span>
          <Switch
            checked={operator?.is_online || false}
            onCheckedChange={toggleOnline}
          />
          <div
            className={`h-2 w-2 rounded-full ${
              operator?.is_online ? "bg-green-500" : "bg-muted"
            }`}
          />
        </div>

        <div className="h-6 w-px bg-border" />

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>

        <Button variant="ghost" size="sm" onClick={handleSignOut}>
          <LogOut className="h-4 w-4 mr-2" />
          Sair
        </Button>
      </div>
    </header>
  );
}
