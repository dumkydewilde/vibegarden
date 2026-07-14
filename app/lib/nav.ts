import {
  Archive,
  BookOpen,
  Home,
  Images,
  Lightbulb,
  Sprout,
  UserCog,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

export const navItems: NavItem[] = [
  { to: "/", label: "Home", icon: Home },
  { to: "/garden", label: "Idea Garden", icon: Sprout },
  { to: "/learning", label: "Learning", icon: BookOpen },
  { to: "/artifacts", label: "Artifacts", icon: Archive },
  { to: "/gallery", label: "Gallery", icon: Images },
  { to: "/inspiration", label: "Inspiration", icon: Lightbulb },
  { to: "/admin", label: "Admin", icon: UserCog, adminOnly: true },
];
