import { cn } from "@/lib/cn";
import type { SkillActivation } from "@/api/client";

interface SkillMatrixProps {
  skills: SkillActivation[];
  onToggle?: (skill: string, host: string, current: boolean) => void;
  toggling?: Set<string>; // "skill:host" keys
  className?: string;
}

export function SkillMatrix({
  skills,
  onToggle,
  toggling = new Set(),
  className,
}: SkillMatrixProps) {
  if (skills.length === 0) return null;

  // Collect all unique hosts
  const allHosts = Array.from(
    new Set(skills.flatMap((s) => Object.keys(s.hosts))),
  ).sort();

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-slate-700/50">
            <th className="text-left py-2 pr-4 pl-1 text-slate-400 font-medium uppercase tracking-wider text-[10px] mono min-w-[160px]">
              skill
            </th>
            {allHosts.map((host) => (
              <th
                key={host}
                className="py-2 px-3 text-center text-slate-400 font-medium uppercase tracking-wider text-[10px] mono"
              >
                {host}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/50">
          {skills.map((skill) => (
            <tr
              key={skill.skill}
              className="group hover:bg-slate-800/30 transition-colors duration-100"
            >
              <td className="py-2 pr-4 pl-1">
                <span className="mono text-slate-300 font-medium">
                  {skill.skill}
                </span>
              </td>
              {allHosts.map((host) => {
                const active = skill.hosts[host] ?? false;
                const key = `${skill.skill}:${host}`;
                const isToggling = toggling.has(key);

                return (
                  <td key={host} className="py-2 px-3 text-center">
                    <button
                      type="button"
                      title={
                        active
                          ? `Deactivate ${skill.skill} on ${host}`
                          : `Activate ${skill.skill} on ${host}`
                      }
                      disabled={isToggling || !onToggle}
                      onClick={() => onToggle?.(skill.skill, host, active)}
                      className={cn(
                        "inline-flex items-center justify-center w-6 h-6 rounded-[2px] transition-all duration-150",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400",
                        active
                          ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30"
                          : "bg-slate-800/60 text-slate-600 border border-slate-700/30 hover:bg-slate-700/60 hover:text-slate-400",
                        isToggling && "opacity-40 cursor-not-allowed",
                        !onToggle && "cursor-default",
                      )}
                    >
                      {isToggling ? (
                        <span className="w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin" />
                      ) : active ? (
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M4.5 12.75l6 6 9-13.5"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
