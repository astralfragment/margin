import { create } from 'zustand';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

interface Choice {
  label: string;
  value: string | null;
  variant?: 'default' | 'outline' | 'destructive';
}

interface Question {
  title: string;
  body: string;
  choices: Choice[];
  answer: (value: string | null) => void;
}

const useQuestion = create<{ question: Question | null }>(() => ({ question: null }));

/**
 * Asks a question in a small sheet and resolves with the value of the choice picked, or null on Escape.
 * The first choice gets focus, so put the safe one first.
 * @param ask The title, body and choices.
 */
export function confirm(ask: Omit<Question, 'answer'>): Promise<string | null> {
  return new Promise((resolve) => {
    useQuestion.setState({
      question: {
        ...ask,
        answer: (value) => {
          useQuestion.setState({ question: null });
          resolve(value);
        },
      },
    });
  });
}

/** The sheet that `confirm` fills. Rendered once by the report. */
export function ConfirmDialog() {
  const question = useQuestion((state) => state.question);
  return (
    <AlertDialog open={Boolean(question)} onOpenChange={(open) => !open && question?.answer(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{question?.title}</AlertDialogTitle>
          <AlertDialogDescription>{question?.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {question?.choices.map((choice, index) => (
            <Button
              key={choice.label}
              variant={choice.variant ?? (index === 0 ? 'outline' : 'default')}
              autoFocus={index === 0}
              onClick={() => question.answer(choice.value)}
            >
              {choice.label}
            </Button>
          ))}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
