import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';

import HomeMapScreen from '../screens/HomeMapScreen';
import DogProfileCard from '../screens/DogProfileCard';
import PlaydateScheduler from '../screens/PlaydateScheduler';
import InboxScreen from '../screens/InboxScreen';
import ChatThread from '../screens/ChatThread';
import MyProfileScreen from '../screens/MyProfileScreen';
import DogProfileCreator from '../screens/DogProfileCreator';

import { colors, borderRadius, shadows } from '../config/theme';

const Root    = createStackNavigator();
const Stack   = createStackNavigator();
const Tab     = createBottomTabNavigator();

const headerOptions = {
  headerStyle: {
    backgroundColor: colors.offWhite,
    shadowColor: 'transparent',
    elevation: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitleStyle: { fontWeight: '800', fontSize: 18, color: colors.darkBrown },
  headerTintColor: colors.primary,
  headerBackTitle: '',
};

function HomeStack() {
  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen name="HomeMap" component={HomeMapScreen} options={{ headerShown: false }} />
      <Stack.Screen name="DogProfileCard" component={DogProfileCard} options={{ headerShown: false }} />
      <Stack.Screen name="PlaydateScheduler" component={PlaydateScheduler} options={{ title: 'Schedule Playdate' }} />
    </Stack.Navigator>
  );
}

function MessagesStack() {
  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen name="Inbox" component={InboxScreen} options={{ title: 'Messages' }} />
      <Stack.Screen name="ChatThread" component={ChatThread} options={{ title: 'Chat', headerTitleAlign: 'left' }} />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen name="MyProfile" component={MyProfileScreen} options={{ title: 'My Profile' }} />
      <Stack.Screen name="DogProfileCreator" component={DogProfileCreator} options={{ title: 'Edit Dog Profile' }} />
    </Stack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingBottom: 6,
          paddingTop: 6,
          height: 60,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mediumGray,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarIcon: ({ focused, color }) => {
          const icons = {
            HomeTab:     focused ? 'map'            : 'map-outline',
            MessagesTab: focused ? 'chatbubbles'    : 'chatbubbles-outline',
            ProfileTab:  focused ? 'person-circle'  : 'person-circle-outline',
          };
          return <Ionicons name={icons[route.name] || 'ellipse'} size={24} color={color} />;
        },
      })}
    >
      <Tab.Screen name="HomeTab"     component={HomeStack}     options={{ title: 'Explore' }} />
      <Tab.Screen name="MessagesTab" component={MessagesStack} options={{ title: 'Messages' }} />
      <Tab.Screen name="ProfileTab"  component={ProfileStack}  options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}

// Root navigator: shows DogSetup first for new users, then Main tabs
export default function AppNavigator({ hasDog, onDogCreated, navigationRef }) {
  return (
    <NavigationContainer ref={navigationRef}>
      <Root.Navigator screenOptions={{ headerShown: false, animationEnabled: true }}>
        {!hasDog && (
          <Root.Screen name="DogSetup">
            {(props) => <DogProfileCreator {...props} onDogCreated={onDogCreated} />}
          </Root.Screen>
        )}
        <Root.Screen name="Main" component={MainTabs} />
      </Root.Navigator>
    </NavigationContainer>
  );
}
