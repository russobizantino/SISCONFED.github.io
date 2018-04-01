import * as React from 'react';
import * as firebase from 'firebase';
import * as _ from 'lodash';
import { MemberID, nameToCountryOption, MemberData } from './Member';
import { AmendmentID, AmendmentData, DEFAULT_AMENDMENT, AMENDMENT_STATUS_OPTIONS } from './Amendment';
import { Card, Button, Form, Dimmer, Dropdown, Segment, Input, TextArea, 
  List, Label, SemanticICONS } from 'semantic-ui-react';
import { CommitteeData } from './Committee';
import { CaucusID } from './Caucus';
import { RouteComponentProps } from 'react-router';
import { URLParameters } from '../types';
import { dropdownHandler, fieldHandler, textAreaHandler, countryDropdownHandler } from '../actions/handlers';
import { objectToList, makeDropdownOption } from '../utils';
import { CountryOption } from '../constants';
import { Loading } from './Loading';
import { canVote } from './CommitteeAdmin';
import { voteOnResolution } from '../actions/resolutionActions';

interface Props extends RouteComponentProps<URLParameters> {
}

interface State {
  committeeFref: firebase.database.Reference;
  committee?: CommitteeData;
}

export enum ResolutionStatus {
  Passed = 'Passed',
  Ongoing = 'Ongoing',
  Failed = 'Failed'
}

const RESOLUTION_STATUS_OPTIONS = [
  ResolutionStatus.Ongoing,
  ResolutionStatus.Passed,
  ResolutionStatus.Failed
].map(makeDropdownOption);

export type ResolutionID = string;

export interface ResolutionData {
  name: string;
  proposer: MemberID;
  seconder: MemberID;
  status: ResolutionStatus;
  caucus?: CaucusID;
  amendments?: Map<AmendmentID, AmendmentData>;
  votes?: Votes;
}

export enum Vote {
  For = 'For',
  Abstaining = 'Abstaining',
  Against = 'Against'
}

type Votes = Map<string, Vote>;

export const DEFAULT_RESOLUTION: ResolutionData = {
  name: '',
  proposer: '',
  seconder: '',
  status: ResolutionStatus.Ongoing,
  caucus: '',
  amendments: {} as Map<AmendmentID, AmendmentData>,
  votes: {} as Votes
};

export default class Resolution extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);

    const { match } = props;

    this.state = {
      committeeFref: firebase.database().ref('committees').child(match.params.committeeID)
    };
  }

  firebaseCallback = (committee: firebase.database.DataSnapshot | null) => {
    if (committee) {
      this.setState({ committee: committee.val() });
    }
  }

  componentDidMount() {
    this.state.committeeFref.on('value', this.firebaseCallback);
  }

  componentWillUnmount() {
    this.state.committeeFref.off('value', this.firebaseCallback);
  }

  recoverResolutionRef = () => {
    const resolutionID: ResolutionID = this.props.match.params.resolutionID;

    return this.state.committeeFref
      .child('resolutions')
      .child(resolutionID);
  }

  // DUPE
  recoverCountryOptions = (): CountryOption[] => {
    const { committee } = this.state;

    if (committee) {
      return objectToList(committee.members || {} as Map<MemberID, MemberData>)
        .map(x => nameToCountryOption(x.name));
    }

    return [];
  }

  handlePushAmendment = (): void => {
    this.recoverResolutionRef().child('amendments').push().set(DEFAULT_AMENDMENT);
  }

  renderAmendment = (id: AmendmentID, amendmentData: AmendmentData, amendmentFref: firebase.database.Reference) => {
    const { recoverCountryOptions } = this;
    const { proposer, text, status } = amendmentData;

    const textArea = (
      <TextArea
        value={text}
        autoHeight
        onChange={textAreaHandler<AmendmentData>(amendmentFref, 'text')}
        fluid
        rows={1}
        placeholder="Text"
      />
    );

    const statusDropdown = (
      <Dropdown 
        value={status} 
        options={AMENDMENT_STATUS_OPTIONS} 
        onChange={dropdownHandler<AmendmentData>(amendmentFref, 'status')} 
      /> 
    );

    const countryOptions = recoverCountryOptions();

    const amendment = (
      <Form.Dropdown
        key="proposer"
        value={nameToCountryOption(proposer).key}
        search
        selection
        fluid
        onChange={countryDropdownHandler<AmendmentData>(amendmentFref, 'proposer', countryOptions)}
        options={countryOptions}
        label="Proposer"
      />
    );

    return (
      <Card 
        key={id}
      >
        <Card.Content>
          <Card.Header>
            {statusDropdown}
            <Button
              floated="right"
              icon="trash"
              negative
              basic
              onClick={() => amendmentFref.remove()}
            />
          </Card.Header>
          <Form>
            {textArea}
          </Form>
          <Card.Meta>
            {amendment}
          </Card.Meta>
        </Card.Content>
      </Card>
    );
  }

  cycleVote = (memberID: MemberID, currentVote?: Vote) => {
    const { resolutionID, committeeID } = this.props.match.params;

    // leave this be in the case of undefined and Against
    let newVote: Vote = Vote.For;

    if (currentVote === Vote.For) {
      newVote = Vote.Abstaining;
    } else if (currentVote === Vote.Abstaining) {
      newVote = Vote.Against;
    }
    
    voteOnResolution(committeeID, resolutionID, memberID, newVote)
  }

  renderVotingMember = (key: MemberID, member: MemberData, vote?: Vote) => {
    const { cycleVote } = this;

    let color: 'green' | 'yellow' | 'red' | undefined;
    let icon: SemanticICONS = 'question circle';

    if (vote === Vote.For) {
      color = 'green';
      icon = 'plus';
    } else if (vote === Vote.Abstaining) {
      color = 'yellow';
      icon = 'minus';
    } else if (vote === Vote.Against) {
      color = 'red';
      icon = 'remove';
    }

    const button = (
      <Button
        color={color}
        icon={icon}
        onClick={() => cycleVote(key, vote)}
      />
    );

    return (
      <List.Item key={key}>
        {button}
        <List.Content>
          {member.name}
        </List.Content>
      </List.Item>
    );
  }

  renderVotingMembers = (members: Map<string, MemberData>, votes: Votes) => {
    const { renderVotingMember } = this;

    return _.chain(members)
      .keys()
      .filter(key => canVote(members[key]))
      .sortBy(key => [members[key].name])
      .map(key => renderVotingMember(key, members[key], votes[key]))
      .value();
  }

  renderVoting = (resolution?: ResolutionData) => {
    const { renderVotingMembers } = this;
    const { committee } = this.state;

    const members = committee ? committee.members : undefined;
    const votes = resolution ? resolution.votes : undefined;

    return (
      <List
        divided
        verticalAlign="middle"
      >
        {renderVotingMembers(
          members || {} as Map<string, MemberData>,
          votes || {} as Votes)}
      </List>
    );
  }

  renderHeader = (resolution?: ResolutionData) => {
    const resolutionFref = this.recoverResolutionRef();
    const { recoverCountryOptions } = this;

    const statusDropdown = (
      <Dropdown 
        value={resolution ? resolution.status : ResolutionStatus.Ongoing} 
        options={RESOLUTION_STATUS_OPTIONS} 
        onChange={dropdownHandler<ResolutionData>(resolutionFref, 'status')} 
      /> 
    );

    const countryOptions = recoverCountryOptions();

    const proposerTree = (
      <Form.Dropdown
        key="proposer"
        value={nameToCountryOption(resolution ? resolution.proposer : '').key}
        search
        selection
        fluid
        onChange={countryDropdownHandler<ResolutionData>(resolutionFref, 'proposer', countryOptions)}
        options={countryOptions}
        label="Proposer"
      />
    );

    const seconderTree = (
      <Form.Dropdown
        key="seconder"
        value={nameToCountryOption(resolution ? resolution.seconder : '').key}
        search
        selection
        fluid
        onChange={countryDropdownHandler<ResolutionData>(resolutionFref, 'seconder', countryOptions)}
        options={countryOptions}
        label="Seconder"
      />
    );

    return (
        <Segment loading={!resolution}>
          <Input
            value={resolution ? resolution.name : ''}
            label={statusDropdown}
            labelPosition="right"
            onChange={fieldHandler<ResolutionData>(resolutionFref, 'name')}
            attatched="top"
            size="massive"
            fluid
            placeholder="Resolution Name"
          />
        <Form>
          <Form.Group widths="equal">
            {proposerTree}
            {seconderTree}
          </Form.Group>
        </Form>
      </Segment>
    );
  }

  renderAmendments = (amendments: Map<AmendmentID, AmendmentData>) => {
    const { renderAmendment, recoverResolutionRef } = this;

    const resolutionRef = recoverResolutionRef();

    return Object.keys(amendments).map(key => {
      return renderAmendment(key, amendments[key], resolutionRef.child('amendments').child(key));
    });
  }

  renderAmendmentsGroup = (resolution?: ResolutionData) => {
    const { renderAmendments, handlePushAmendment } = this;

    const amendments = resolution ? resolution.amendments : undefined;

    const adder = (
      <Card>
        <Card.Content>
          <Button
            icon="plus"
            primary
            fluid
            basic
            onClick={handlePushAmendment}
          />
        </Card.Content>
      </Card>
    );

    return (
      <Card.Group
        itemsPerRow={1} 
      >
        {adder}
        {renderAmendments(amendments || {} as Map<string, AmendmentData>)}
      </Card.Group>
    );
  }

  renderResolution = (resolution?: ResolutionData) => {
    const { renderHeader, renderAmendmentsGroup, renderVoting } = this;

    return (
      <div>
        {renderHeader(resolution)}
        {renderAmendmentsGroup(resolution)}
        {renderVoting(resolution)}
      </div>
    );
  }

  render() {
    const { committee } = this.state;
    const resolutionID: ResolutionID = this.props.match.params.resolutionID;

    const resolutions = committee ? committee.resolutions : {};
    const resolution = (resolutions || {})[resolutionID];

    return this.renderResolution(resolution);
  }
}