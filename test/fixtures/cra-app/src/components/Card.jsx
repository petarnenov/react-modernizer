import { getUser } from 'api/users';
import { format } from '../utils/format';
import styles from './Card.module.css';

export default function Card({ id }) {
  return <p className={styles.card}>{format(getUser(id))}</p>;
}
