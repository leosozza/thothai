import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/hooks/useAuth";
import { WorkspaceProvider } from "@/hooks/useWorkspace";

// Pages
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Instances from "./pages/Instances";
import Conversations from "./pages/Conversations";
import Contacts from "./pages/Contacts";
import Training from "./pages/Training";
import Personas from "./pages/Personas";
import Departments from "./pages/Departments";
import Flows from "./pages/Flows";
import Integrations from "./pages/Integrations";
import Settings from "./pages/Settings";
import Playground from "./pages/Playground";
import Bitrix24Setup from "./pages/Bitrix24Setup";
import Bitrix24App from "./pages/Bitrix24App";
import License from "./pages/License";
import Privacy from "./pages/Privacy";
import Docs from "./pages/Docs";
import GenerateLogo from "./pages/GenerateLogo";
import AIProviders from "./pages/AIProviders";
import Diagnostics from "./pages/Diagnostics";
import Calls from "./pages/Calls";
import Operator from "./pages/Operator";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider
    attribute="class"
    defaultTheme="thoth24"
    themes={["light", "dark", "thoth24"]}
    enableSystem={false}
    storageKey="thoth-theme"
  >
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <Routes>
            {/* Rotas públicas para Bitrix24 - fora dos providers de auth */}
            <Route path="/bitrix24-setup" element={<Bitrix24Setup />} />
            <Route path="/bitrix24-app" element={<Bitrix24App />} />
            <Route path="/license" element={<License />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/generate-logo" element={<GenerateLogo />} />
            
            {/* Rotas protegidas com autenticação */}
            <Route
              path="/*"
              element={
                <AuthProvider>
                  <WorkspaceProvider>
                    <Routes>
                      <Route path="/" element={<Index />} />
                      <Route path="/auth" element={<Auth />} />
                      <Route path="/dashboard" element={<Dashboard />} />
                      <Route path="/instances" element={<Instances />} />
                      <Route path="/conversations" element={<Conversations />} />
                      <Route path="/contacts" element={<Contacts />} />
                      <Route path="/training" element={<Training />} />
                      <Route path="/personas" element={<Personas />} />
                      <Route path="/departments" element={<Departments />} />
                      <Route path="/flows" element={<Flows />} />
                      <Route path="/integrations" element={<Integrations />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route path="/settings/ai-providers" element={<AIProviders />} />
                      <Route path="/settings/diagnostics" element={<Diagnostics />} />
                      <Route path="/analytics" element={<Dashboard />} />
                      <Route path="/playground" element={<Playground />} />
                      <Route path="/calls" element={<Calls />} />
                      <Route path="/operator" element={<Operator />} />
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </WorkspaceProvider>
                </AuthProvider>
              }
            />
          </Routes>
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
