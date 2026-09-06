import { Eye, EyeOff } from "lucide-react"
import * as React from "react"
import { useTranslation } from "react-i18next"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const { t } = useTranslation("common")
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-8", className)} {...props} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        title={visible ? t("passwordInput.hide") : t("passwordInput.show")}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

export { PasswordInput }
