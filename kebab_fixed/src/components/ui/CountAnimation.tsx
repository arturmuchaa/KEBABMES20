import React from 'react'
import { cn } from '@/lib/utils'
import {
  useMotionValue,
  useTransform,
  animate,
  useMotionValueEvent,
} from 'motion/react'

interface Props {
  number: number
  className?: string
  prefix?: string
  suffix?: string
  duration?: number
}

export default function CountAnimation({
  number,
  className,
  prefix,
  suffix,
  duration = 1.4,
}: Props) {
  const count = useMotionValue(0)
  const rounded = useTransform(count, Math.round)
  const [current, setCurrent] = React.useState(0)

  React.useEffect(() => {
    const animation = animate(count, number, { duration })
    return animation.stop
  }, [count, number, duration])

  useMotionValueEvent(rounded, 'change', (latest) => {
    setCurrent(latest)
  })

  return (
    <span className={cn(className)}>
      {prefix}
      {current.toLocaleString('pl-PL')}
      {suffix}
    </span>
  )
}
