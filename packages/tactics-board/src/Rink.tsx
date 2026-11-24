import { useId } from 'react'
import { rinkGeometry } from './geometry'
import type { RinkTemplate } from './types'

export function Rink({ template }: { template: RinkTemplate }) {
  const clip = useId()
  const { x, y, radius, goalX, blueX, endFaceoffX, neutralFaceoffX } = rinkGeometry(template)
  const halfGoal = (template.goal_width_m ?? 1.8288) / 2
  return <>
    <defs>
      <clipPath id={clip}><rect x={-x} y={-y} width={x * 2} height={y * 2} rx={radius} /></clipPath>
    </defs>
    <rect x={-x} y={-y} width={x * 2} height={y * 2} rx={radius} fill="#f5faff" />
    <g clipPath={`url(#${clip})`}>
      <rect x={-blueX} y={-y} width={blueX * 2} height={y * 2} fill="#ecf5ff" />
      <path d={`M 0 ${-y} V ${y}`} stroke="#dc6077" strokeWidth=".23" />
      <circle r={template.faceoff_circle_radius_m} fill="none" stroke="#7d9de1" strokeWidth=".11" />
      <circle r=".27" fill="#4a73c7" />
      {[-1, 1].map(side => {
        const goal = goalX * side
        const end = endFaceoffX * side
        const neutral = neutralFaceoffX * side
        return <g key={side}>
          <path d={`M ${blueX * side} ${-y} V ${y}`} stroke="#668cd7" strokeWidth=".28" />
          <path d={`M ${goal} ${-y} V ${y}`} stroke="#d16e80" strokeWidth=".12" />
          {template.trapezoid && [-1, 1].map(sign => <line key={sign}
            x1={goal} y1={sign * template.trapezoid!.goal_line_half_width_m}
            x2={x * side} y2={sign * template.trapezoid!.end_boards_half_width_m}
            stroke="#d16e80" strokeWidth=".1" opacity=".65" />)}
          <path d={`M ${goal} ${-halfGoal} Q ${goal - side * 3.2} 0 ${goal} ${halfGoal} Z`}
            fill="#bdddf8" stroke="#c45d73" strokeWidth=".1" />
          <path d={`M ${goal} ${-halfGoal} Q ${goal + side * 2.2} 0 ${goal} ${halfGoal} Z`}
            fill="#ffffff" stroke="#b74c66" strokeWidth=".14" />
          {[-1, 1].map(sign => <g key={sign} stroke="#d77f91" strokeWidth=".1">
            <circle cx={end} cy={sign * template.end_faceoff.from_centre_y_m}
              r={template.faceoff_circle_radius_m} fill="none" />
            <circle cx={end} cy={sign * template.end_faceoff.from_centre_y_m} r=".24" fill="#cd657b" />
            <circle cx={neutral} cy={sign * template.neutral_faceoff.from_centre_y_m} r=".24" fill="#cd657b" />
          </g>)}
        </g>
      })}
    </g>
    <rect x={-x} y={-y} width={x * 2} height={y * 2} rx={radius} fill="none" stroke="#9bb1cd" strokeWidth=".22" />
  </>
}
