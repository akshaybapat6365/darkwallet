import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Cpu, Fingerprint, Radio, ShieldCheck } from 'lucide-react';

import type { JobEvent, JobSnapshot, JobStage } from '../../lib/api';
import { Progress } from '../ui/progress';

const stageOrder: JobStage[] = ['QUEUED', 'AWAITING_SIGNATURE', 'PROOF_COMPUTING', 'TX_BUILDING', 'RELAYING', 'CONFIRMED'];

const stageLabels: Record<JobStage, string> = {
  QUEUED: 'Queued',
  AWAITING_SIGNATURE: 'Awaiting Wallet Signature',
  PROOF_COMPUTING: 'Computing ZK Proof',
  TX_BUILDING: 'Constructing Transaction',
  RELAYING: 'Relaying to Midnight',
  CONFIRMED: 'Block Confirmed',
  FAILED: 'Execution Failed',
};

const stageIcon = (stage: JobStage) => {
  switch (stage) {
    case 'QUEUED':
      return <Radio className="h-4 w-4" />;
    case 'AWAITING_SIGNATURE':
      return <ShieldCheck className="h-4 w-4" />;
    case 'PROOF_COMPUTING':
      return <Fingerprint className="h-4 w-4" />;
    case 'TX_BUILDING':
      return <Cpu className="h-4 w-4" />;
    case 'RELAYING':
      return <Radio className="h-4 w-4" />;
    default:
      return <CheckCircle2 className="h-4 w-4" />;
  }
};

const randomHexLine = (length: number) =>
  Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');

export const JobTracker = ({
  job,
  event,
}: {
  job: JobSnapshot | null;
  event: JobEvent | null;
}) => {
  const hashingLines = Array.from({ length: 5 }, () => randomHexLine(56));
  const stageIndex = job?.stage ? stageOrder.indexOf(job.stage) : -1;
  const progress = job?.progressPct ?? (job?.status === 'failed' ? 100 : 0);

  return (
    <AnimatePresence>
      {job ? (
        <motion.div
          key={job.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="rounded-lg border border-border/70 bg-card/80 p-4"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Cryptographic Pipeline</div>
              <div className="font-medium">{stageLabels[job.stage]}</div>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              job <span className="font-mono">{job.id}</span>
            </div>
          </div>

          <Progress value={progress} className="mb-4" />

          <div className="grid gap-2 md:grid-cols-3">
            {stageOrder.map((stage, idx) => {
              const done = stageIndex >= idx || job.stage === 'FAILED';
              const current = job.stage === stage;
              return (
                <motion.div
                  key={stage}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: done ? 1 : 0.55, y: 0 }}
                  transition={{ delay: idx * 0.04 }}
                  className={`rounded-md border p-2 text-xs ${current ? 'border-primary bg-primary/10' : 'border-border/60 bg-background/70'}`}
                >
                  <div className="flex items-center gap-2 font-medium">
                    {stageIcon(stage)}
                    {stageLabels[stage]}
                  </div>
                </motion.div>
              );
            })}
          </div>

          {job.stage === 'PROOF_COMPUTING' ? (
            <div className="mt-3 overflow-hidden rounded-md border border-primary/30 bg-primary/5 p-3">
              <div className="mb-2 text-[11px] uppercase tracking-[0.14em] text-primary/80">Cryptographic Hashing Stream</div>
              <div className="space-y-1 font-mono text-[11px] text-primary/80">
                {hashingLines.map((line, idx) => (
                  <motion.div
                    key={`${line}-${idx}`}
                    initial={{ opacity: 0.2, x: -8 }}
                    animate={{ opacity: [0.25, 0.95, 0.35], x: [0, 4, 0] }}
                    transition={{ duration: 1.2 + idx * 0.08, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    {line}
                  </motion.div>
                ))}
              </div>
            </div>
          ) : null}

          {event?.message ? (
            <div className="mt-3 text-xs text-muted-foreground">
              <span className="font-medium">Latest:</span> {event.message}
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
