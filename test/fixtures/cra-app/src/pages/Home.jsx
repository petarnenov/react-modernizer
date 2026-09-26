import React from 'react';
import Card from '../components/Card';
import { list } from 'components';
import Missing from './Missing';

export default class Home extends React.Component {
  render() {
    return <div>{list.map((id) => <Card key={id} id={id} />)}<Missing /></div>;
  }
}
